import { formatDayLong, formatRange, pacificDate } from "@/club/time";

/** "Thursday, Oct 29, 7:00 to 9:00 am". */
export const whenWords = (startsAt: string, endsAt: string): string => `${formatDayLong(pacificDate(new Date(startsAt)))}, ${formatRange(startsAt, endsAt)}`;
