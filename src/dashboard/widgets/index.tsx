import type { ReactNode } from 'react';
import type { WidgetType } from '../../lib/dashboard';
import type { WidgetProps } from './shared';
import { ClockWidget } from './ClockWidget';
import { WeatherWidget } from './WeatherWidget';
import { PollenWidget } from './PollenWidget';
import { EventsWidget } from './EventsWidget';
import { TimetableWidget } from './TimetableWidget';
import { TodosWidget } from './TodosWidget';
import { ShoppingWidget } from './ShoppingWidget';
import { PhotosWidget } from './PhotosWidget';
import { HolidaysWidget } from './HolidaysWidget';
import { FamilyWidget } from './FamilyWidget';
import { AppWidget } from './AppWidget';
import { BatteryWidget } from './BatteryWidget';

export { DashCtx, type DashData } from './shared';

/** widget type -> component */
export const WIDGET_COMPONENTS: Record<WidgetType, (p: WidgetProps) => ReactNode> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  events: EventsWidget,
  timetable: TimetableWidget,
  todos: TodosWidget,
  shopping: ShoppingWidget,
  photos: PhotosWidget,
  holidays: HolidaysWidget,
  pollen: PollenWidget,
  family: FamilyWidget,
  app: AppWidget,
  battery: BatteryWidget,
};
