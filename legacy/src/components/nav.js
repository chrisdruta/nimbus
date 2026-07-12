import { useContext } from 'react';

import { LoginArea, LogoutArea } from './loginAreas';

import SoundCloudClient from '../soundcloudClient';

import { Context, initialState } from '../store';

import './nav.css';


const divider = <div className="divider"/>

function SideNav() {
    const { store, dispatch } = useContext(Context);

    const makePlaylists = () => {
        if (store.user.playlists === null) {
            return <></>;
        } else {
            return store.user.playlists.map((playlist, idx) => {
                return <span className="nav-playlist" key={`nav-playlist-${playlist.id}`} onClick={() => dispatch({ type: "set-browseplaylist", data: idx })} >
                    {playlist.title}
                </span>;
            });
        }
    }

    return (
        <div className="side-nav">
            <div className="github-container">
                <a href="https://soundcloud.com">
                    <img src="https://developers.soundcloud.com/assets/powered_by_white-371bd6967352fcc89673d4c81f7e5661.png" />
                </a>
                <a className="github-button" href="https://github.com/chrisdruta/nimbus" data-icon="octicon-star" data-show-count="true" aria-label="Star chrisdruta/nimbus on GitHub">Star</a>
                <a className="github-button" href="https://github.com/chrisdruta/nimbus/fork" data-icon="octicon-repo-forked" aria-label="Fork chrisdruta/nimbus on GitHub">Fork</a>
            </div>
            <span className="nimbus">nimbus</span>
            {divider}
            { store.user.profile === null ? <LoginArea /> : <LogoutArea /> }
            {divider}
            <span className="nav-label">YOUR PUBLIC LIBRARY</span>
            <span className="nav-playlist" onClick={() => dispatch({ type: "set-browseplaylist", data: "userLikes" })}>Liked Tracks</span>
            <span className="nav-label">PLAYLISTS</span>
            {makePlaylists()}
        </div>
    );
}

export default SideNav;