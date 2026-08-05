import { google } from "googleapis";
import { config } from "../config";

/**
 * Google Meet link generation for online interviews.
 *
 * A Meet link is created by inserting a Google Calendar event with a
 * `conferenceData` request. That requires a Google Workspace service account
 * with **domain-wide delegation** + the **Calendar API**, impersonating a real
 * Workspace user (config.googleCalendar.impersonate). Set:
 *   GOOGLE_CALENDAR_KEY_FILE     path to the service-account JSON
 *   GOOGLE_CALENDAR_IMPERSONATE  the Workspace user email to create events as
 *   GOOGLE_CALENDAR_ID           optional, defaults to "primary"
 */

export function googleCalendarConfigured(): boolean {
  return !!(config.googleCalendar.keyFile && config.googleCalendar.impersonate);
}

/**
 * Insert a Calendar event with a Meet conference and return the Meet URL.
 * Returns null if Google Calendar isn't configured (caller should fall back to
 * a manual link). Throws if the API call fails so the caller can surface it.
 */
export async function createMeetForInterview(opts: {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: string[]; // candidate + panel emails
}): Promise<string | null> {
  if (!googleCalendarConfigured()) return null;

  const auth = new google.auth.JWT({
    keyFile: config.googleCalendar.keyFile,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject: config.googleCalendar.impersonate, // domain-wide delegation
  });

  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.insert({
    calendarId: config.googleCalendar.calendarId,
    conferenceDataVersion: 1,
    // We send our own interview emails, so suppress Google's calendar invites.
    sendUpdates: "none",
    requestBody: {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.start.toISOString() },
      end: { dateTime: opts.end.toISOString() },
      attendees: (opts.attendees || [])
        .filter((e) => !!e)
        .map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: `itv-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const link =
    res.data.hangoutLink ||
    res.data.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === "video",
    )?.uri ||
    null;

  return link;
}
