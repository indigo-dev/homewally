import { useId } from 'react';
import { batteryTone, buildBatteryChart, useBattery, type BatterySample } from '../../lib/battery';
import { useMinute } from '../../lib/clock';
import { Empty, Head, type WidgetProps } from './shared';
import { t } from '../../i18n';

function formatChargeEta(minutes: number): string {
  if (minutes < 60) return t('dashboard.battery.etaMin', { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? t('dashboard.battery.etaHourMin', { h, m }) : t('dashboard.battery.etaHour', { h });
}

/** Classic horizontal filled battery graphic with positive terminal cap and charging bolt. */
function BatteryGraphic({ level, charging }: { level: number; charging: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(level)));
  return (
    <div className={`dw-bat-icon ${charging ? 'charging' : ''}`} role="img" aria-label={`${pct} %`}>
      <div className="dw-bat-shell">
        <div className="dw-bat-fill" style={{ width: `${pct}%` }} />
        {charging && (
          <svg className="dw-bat-bolt" viewBox="0 0 20 20" aria-hidden>
            <path d="M11.6 1.8 4.4 11h4.8l-.8 7.2 7.2-9.2h-4.8l.8-7.2Z" />
          </svg>
        )}
      </div>
      <span className="dw-bat-cap" aria-hidden />
    </div>
  );
}

/** Smooth 24-hour battery curve (SVG) with gradient area fill and dashed bridges across offline gaps. */
function BatteryGraph({ samples, nowMs, tall }: { samples: BatterySample[]; nowMs: number; tall: boolean }) {
  const gradId = useId();
  const w = tall ? 160 : 220;
  const h = tall ? 112 : 82;
  const chart = buildBatteryChart(samples, nowMs, w, h, 4, 8);

  if (!chart) {
    return (
      <div className="dw-bat-chart-empty">
        <span>{t('dashboard.battery.collecting')}</span>
      </div>
    );
  }

  return (
    <div className="dw-bat-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bat-c)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--bat-c)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} className="dw-bat-guide" />
        {chart.segments.map((seg, i) => (
          <g key={i}>
            {seg.area && <path d={seg.area} fill={`url(#${gradId})`} />}
            <path d={seg.line} className="dw-bat-line" />
          </g>
        ))}
        {chart.bridges.map((d, i) => (
          <path key={i} d={d} className="dw-bat-gap" />
        ))}
        <circle cx={chart.last.x} cy={chart.last.y} r="3.6" className="dw-bat-dot" />
      </svg>
      <div className="dw-bat-axis">
        <span>{t('dashboard.battery.hoursAgo', { n: chart.spanHours })}</span>
        <span>{t('dashboard.now')}</span>
      </div>
    </div>
  );
}

export function BatteryWidget({ size }: WidgetProps) {
  const { status, history } = useBattery();
  const now = useMinute();

  if (!status) return <Empty>{t('dashboard.loading')}</Empty>;

  const tone = batteryTone(status.level);
  const stateText = status.full
    ? t('dashboard.battery.full')
    : status.charging
      ? status.chargeTimeMin
        ? t('dashboard.battery.chargingEta', { eta: formatChargeEta(status.chargeTimeMin) })
        : t('dashboard.battery.charging')
      : t('dashboard.battery.onBattery');

  const hasGraph = size === 'm' || size === 't';

  return (
    <div className={`dw-battery ${size} tone-${tone} ${status.charging ? 'charging' : ''}`}>
      <Head
        icon="🔋"
        title={t('dashboard.widgets.battery.title')}
        meta={size !== 's' && status.tempC !== undefined ? `${Math.round(status.tempC)} °C` : undefined}
      />
      <div className="dw-bat-content">
        <div className="dw-bat-summary">
          <BatteryGraphic level={status.level} charging={status.charging} />
          <div className="dw-bat-readout">
            <span className="dw-bat-pct">{status.level} %</span>
            <span className="dw-bat-state">{stateText}</span>
          </div>
        </div>
        {hasGraph && <BatteryGraph samples={history} nowMs={now.getTime()} tall={size === 't'} />}
      </div>
    </div>
  );
}
