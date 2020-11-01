import { useContext, useEffect, useReducer } from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import ReactLoading from 'react-loading';
import FastAverageColor from 'fast-average-color';

import SoundCloudClient from '../soundcloudClient';

import { Context, initialState } from '../store';

import './browseArea.css';

const fac = new FastAverageColor();
const MISSING_ART_DEFAULT = "https://i1.sndcdn.com/avatars-000572752218-gu88gf-large.jpg";

function BrowseArea() {
    const {store, dispatch} = useContext(Context);

    let tracks = null;
    let title = "default";
    let artwork = MISSING_ART_DEFAULT;

    if (!store.user.profile)
        return <></>;

    if (store.loading) {
        return <ReactLoading type="bars" className="browse-loading" color="#ff4200" />
    }

    if (store.browsePlaylist === "userLikes") {
        title = "liked tracks";
        tracks = store.user.likes;
        artwork = store.user.profile.avatar_url;
    } else if (Number.isInteger(store.browsePlaylist)) {
        title = store.user.playlists[store.browsePlaylist].title;
        tracks = store.user.playlists[store.browsePlaylist].tracks;
        if (store.user.playlists[store.browsePlaylist].artwork_url) {
            artwork = store.user.playlists[store.browsePlaylist].artwork_url;
        }
    };

    (async () =>  {
        const color = await fac.getColorAsync(artwork);
        console.log(color)
        document.getElementById("browse-header").style.backgroundColor = color.hex;
    })();

    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <div id="browse-header" className="browse-area-header" >
                <img className="browse-art" src={artwork.replace("large.jpg", "t300x300.jpg")} />
                <span className="browse-area-title">{title}</span>
            </div>
            <div className="browse-area">
                { tracks === null ?
                    <></>
                :
                tracks.map((track) =>
                    <div className="tile" key={`track-tile-${track.id}`}>
                        <img className="tile-art" src={!!track.artwork_url ? track.artwork_url.replace("large.jpg", "t300x300.jpg") : MISSING_ART_DEFAULT}/>
                        <a href={track.permalink_url} className="tile-title">{track.title}</a>
                        <a href={track.user.permalink_url} className="tile-author">{track.user.username}</a>
                    </div>)
                }
            </div>
        </div>
    );
}

export default BrowseArea;
