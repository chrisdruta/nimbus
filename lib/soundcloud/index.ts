import type { MusicProvider } from "../provider";
import { authorizeUrl, exchangeCode, refresh } from "./auth";
import { getLikesPage, getMe, resolveStream } from "./api";

export const soundcloudProvider: MusicProvider = {
  authorizeUrl,
  exchangeCode,
  refresh,
  getMe,
  getLikesPage,
  resolveStream,
};
