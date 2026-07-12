import type { MusicProvider } from "../provider";
import { authorizeUrl, exchangeCode, refresh } from "./auth";
import {
  getLikesPage,
  getMe,
  getPlaylists,
  getPlaylistTracks,
  resolveStream,
} from "./api";

export const soundcloudProvider: MusicProvider = {
  authorizeUrl,
  exchangeCode,
  refresh,
  getMe,
  getLikesPage,
  getPlaylists,
  getPlaylistTracks,
  resolveStream,
};
