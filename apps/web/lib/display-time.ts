type Timestamp = string | number | Date;
const zone = "Asia/Kolkata";
const dateOptions: Intl.DateTimeFormatOptions = {
  timeZone: zone,
  day: "2-digit",
  month: "short",
  year: "numeric",
};
const clockOptions: Intl.DateTimeFormatOptions = {
  timeZone: zone,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
};
const clock = new Intl.DateTimeFormat("en-IN", clockOptions);
const preciseClock = new Intl.DateTimeFormat("en-IN", {
  ...clockOptions,
  second: "2-digit",
});
const date = new Intl.DateTimeFormat("en-IN", dateOptions);
const dateTime = new Intl.DateTimeFormat("en-IN", {
  ...dateOptions,
  ...clockOptions,
});
function format(value: Timestamp, formatter: Intl.DateTimeFormat) {
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? "-" : formatter.format(instant);
}
// Storage/API timestamps stay UTC; only their user-facing presentation is IST.
export const formatIstTime = (value: Timestamp, seconds = false) =>
  format(value, seconds ? preciseClock : clock);
export const formatIstDate = (value: Timestamp) => format(value, date);
export const formatIstDateTime = (value: Timestamp) => format(value, dateTime);
