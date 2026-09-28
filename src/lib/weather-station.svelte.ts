import type { WeatherPlace, WeatherReport, WeatherUnits } from "./types";
import {
  TORONTO,
  WEATHER_KEY,
  WEATHER_POLL_MS,
  fetchWeatherReport,
  loadWeatherPrefs,
  saveWeatherPrefs,
} from "./weather";
import { startPoll } from "./poller";

export class WeatherStation {
  place = $state<WeatherPlace>(TORONTO);
  units = $state<WeatherUnits>("metric");
  collapsed = $state(false);
  report = $state<WeatherReport | null>(null);
  status = $state<"idle" | "loading" | "live" | "error">("idle");
  error = $state<string | null>(null);
  saved = $state<boolean | null>(null);
  stopPoll: (() => void) | null = null;
  // Only the newest request may land, so a slow reply for the old city
  // cannot overwrite the one just picked.
  ticket = 0;

  constructor() {
    this.restore();
  }

  restore() {
    const prefs = loadWeatherPrefs();
    this.place = prefs.place;
    this.units = prefs.units;
    this.collapsed = prefs.collapsed;
    this.report = prefs.report;
  }

  persist() {
    this.saved = saveWeatherPrefs({
      place: this.place,
      units: this.units,
      collapsed: this.collapsed,
      report: this.report,
    });
  }

  onStorage = (event: StorageEvent) => {
    if (event.key !== WEATHER_KEY && event.key !== null) return;
    const prior = this.place.id;
    this.restore();
    if (this.place.id !== prior) void this.refresh();
  };

  async refresh() {
    const place = this.place;
    const ticket = ++this.ticket;
    if (!this.report) this.status = "loading";
    try {
      const report = await fetchWeatherReport(place);
      if (ticket !== this.ticket) return;
      this.report = report;
      this.status = "live";
      this.error = null;
      this.persist();
    } catch (err) {
      if (ticket !== this.ticket) return;
      this.status = "error";
      this.error = err instanceof Error ? err.message : "Weather feed failed";
    }
  }

  start() {
    if (this.stopPoll) return;
    window.addEventListener("storage", this.onStorage);
    this.stopPoll = startPoll(() => void this.refresh(), WEATHER_POLL_MS);
  }

  stop() {
    window.removeEventListener("storage", this.onStorage);
    this.stopPoll?.();
    this.stopPoll = null;
  }

  setPlace(place: WeatherPlace) {
    if (place.id === this.place.id) return;
    this.place = place;
    // Never show the old city's sky under the new city's name.
    this.report = null;
    this.error = null;
    this.status = "loading";
    this.persist();
    void this.refresh();
  }

  setUnits(units: WeatherUnits) {
    this.units = units;
    this.persist();
  }

  toggle() {
    this.collapsed = !this.collapsed;
    this.persist();
  }
}

export const station = new WeatherStation();
