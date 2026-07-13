import type { MusicProvider } from "../provider";
import { authorizeUrl, exchangeCode, refresh } from "./auth";
import {
  getFeedPage,
  getLikesPage,
  getMe,
  getPlaylists,
  getPlaylistTracks,
  getRelatedTracks,
  getWaveform,
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
  getRelatedTracks,
  getFeedPage,
  resolveStream,
  getWaveform,
};
