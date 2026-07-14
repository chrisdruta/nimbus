import type { MusicProvider } from "../provider";
import { authorizeUrl, exchangeCode, refresh } from "./auth";
import {
  getFeedPage,
  getLikesPage,
  getMe,
  getPlaylists,
  getPlaylistTracks,
  getRelatedTracks,
  getTrackSocial,
  getWaveform,
  resolveStream,
  setArtistFollowed,
  setTrackLiked,
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
  getTrackSocial,
  setTrackLiked,
  setArtistFollowed,
};
