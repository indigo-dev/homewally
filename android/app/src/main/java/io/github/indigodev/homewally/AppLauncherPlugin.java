package io.github.indigodev.homewally;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ComponentName;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.content.res.Resources;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * The launcher functions the web app needs: list the installed apps, start one, open the Android
 * settings, check whether HomeWally is the home app, and keep the screen on.
 * Counterpart in the web app: src/native/launcher.ts
 */
@CapacitorPlugin(name = "AppLauncher")
public class AppLauncherPlugin extends Plugin {

    private static final int ICON_PX = 128;
    private static final int MAX_ICON_PX = 512;
    private BroadcastReceiver packageReceiver;

    @Override
    public void load() {
        // tell the web app when apps are installed or removed, so its list stays current
        packageReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                notifyListeners("appsChanged", new JSObject());
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_PACKAGE_ADDED);
        filter.addAction(Intent.ACTION_PACKAGE_REMOVED);
        filter.addAction(Intent.ACTION_PACKAGE_CHANGED);
        filter.addDataScheme("package");
        ContextCompat.registerReceiver(getContext(), packageReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (packageReceiver != null) {
            try {
                getContext().unregisterReceiver(packageReceiver);
            } catch (IllegalArgumentException ignored) {
                // already unregistered
            }
            packageReceiver = null;
        }
    }

    /** All startable apps (except HomeWally itself) with name and icon as PNG data URL. */
    @PluginMethod
    public void getApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> infos = pm.queryIntentActivities(main, 0);
        String self = getContext().getPackageName();
        boolean withIcons = call.getBoolean("icons", true);
        JSArray apps = new JSArray();
        for (ResolveInfo ri : infos) {
            if (ri.activityInfo == null || self.equals(ri.activityInfo.packageName)) continue;
            JSObject app = new JSObject();
            app.put("packageName", ri.activityInfo.packageName);
            app.put("activity", ri.activityInfo.name);
            CharSequence label = ri.loadLabel(pm);
            app.put("label", label != null ? label.toString() : ri.activityInfo.packageName);
            boolean isSystem = (ri.activityInfo.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
            app.put("system", isSystem);
            if (withIcons) {
                try {
                    app.put("icon", toDataUrl(ri.loadIcon(pm)));
                } catch (Exception ignored) {
                    // no icon: the web app shows the first letter
                }
            }
            apps.put(app);
        }
        JSObject ret = new JSObject();
        ret.put("apps", apps);
        call.resolve(ret);
    }

    /** Starts an app; with `activity` exactly that entry, otherwise the app's default start screen. */
    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("packageName fehlt");
            return;
        }
        String activity = call.getString("activity");
        Intent intent;
        if (activity != null && !activity.isEmpty()) {
            intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(pkg, activity);
        } else {
            intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        }
        if (intent == null) {
            call.reject("App ist nicht installiert");
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("App lässt sich nicht starten", e);
        }
    }

    /** Opens the Android settings: `page` = "home" (choose the home app), "app" (HomeWally's app info) or the main page. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String page = call.getString("page", "");
        Intent intent;
        if ("home".equals(page)) {
            intent = new Intent(Settings.ACTION_HOME_SETTINGS);
        } else if ("app".equals(page)) {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(android.net.Uri.fromParts("package", getContext().getPackageName(), null));
        } else {
            intent = new Intent(Settings.ACTION_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
        } catch (Exception e) {
            // some devices have no "home app" page: fall back to the main settings
            getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /** Opens Android's app info page for a specific package (permissions, storage, force stop, …). */
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("packageName fehlt");
            return;
        }
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(android.net.Uri.fromParts("package", pkg, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("App-Info lässt sich nicht öffnen", e);
        }
    }

    /** Opens Android's uninstall confirmation dialog for a package. */
    @PluginMethod
    public void uninstall(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("packageName fehlt");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_DELETE)
            .setData(android.net.Uri.fromParts("package", pkg, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Deinstallation lässt sich nicht starten", e);
        }
    }

    /** Is HomeWally the current home app? */
    @PluginMethod
    public void isDefaultLauncher(PluginCall call) {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo ri = getContext().getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        boolean isDefault = ri != null && ri.activityInfo != null && getContext().getPackageName().equals(ri.activityInfo.packageName);
        JSObject ret = new JSObject();
        ret.put("value", isDefault);
        call.resolve(ret);
    }

    /** Keeps the screen on while HomeWally is in front (replaces the browser's Wake Lock). */
    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /** Matches Android's status & navigation bar icon contrast to the app's light/dark mode. */
    @PluginMethod
    public void setSystemBars(PluginCall call) {
        boolean dark = call.getBoolean("dark", false);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(!dark);
                controller.setAppearanceLightNavigationBars(!dark);
            }
            call.resolve();
        });
    }

    /**
     * One app's icon in the best resolution the app ships: the drawable for the highest screen density
     * (xxxhdpi), drawn at its full size – 432 px for adaptive icons (108 dp × 4), at most 512 px.
     * For the 1×1 app tiles on the dashboard.
     */
    @PluginMethod
    public void getAppIcon(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("packageName fehlt");
            return;
        }
        String activity = call.getString("activity");
        PackageManager pm = getContext().getPackageManager();
        Drawable icon = null;
        try {
            ActivityInfo ai = null;
            if (activity != null && !activity.isEmpty()) {
                ai = pm.getActivityInfo(new ComponentName(pkg, activity), 0);
            }
            ApplicationInfo app = pm.getApplicationInfo(pkg, 0);
            int res = ai != null && ai.getIconResource() != 0 ? ai.getIconResource() : app.icon;
            if (res != 0) {
                Resources r = pm.getResourcesForApplication(app);
                icon = r.getDrawableForDensity(res, DisplayMetrics.DENSITY_XXXHIGH, null);
            }
            if (icon == null) icon = ai != null ? ai.loadIcon(pm) : app.loadIcon(pm);
        } catch (Exception e) {
            call.reject("App ist nicht installiert", e);
            return;
        }
        int px = icon.getIntrinsicWidth();
        if (Build.VERSION.SDK_INT >= 26 && icon instanceof AdaptiveIconDrawable) px = 432;
        px = Math.max(ICON_PX, Math.min(MAX_ICON_PX, px > 0 ? px : MAX_ICON_PX));
        JSObject ret = new JSObject();
        ret.put("icon", toDataUrl(icon, px));
        ret.put("size", px);
        call.resolve(ret);
    }

    private static String toDataUrl(Drawable icon) {
        return toDataUrl(icon, ICON_PX);
    }

    private static String toDataUrl(Drawable icon, int px) {
        Bitmap bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        icon.setBounds(0, 0, px, px);
        icon.draw(canvas);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Build.VERSION.SDK_INT >= 30 ? Bitmap.CompressFormat.WEBP_LOSSLESS : Bitmap.CompressFormat.PNG, 100, out);
        bmp.recycle();
        String mime = Build.VERSION.SDK_INT >= 30 ? "image/webp" : "image/png";
        return "data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }
}
