import { useContext } from 'react';

import { LoginArea, LogoutArea } from './loginAreas';

import SoundCloudClient from '../soundcloudClient';

import { Context, initialState } from '../store';

import './nav.css';


const divider = <div className="divider"/>

function SideNav() {
    const { store, dispatch } = useContext(Context);

    

    return (
        <div className="side-nav">
            <div className="github-container">
                <a href="https://soundcloud.com">
                    <img src="https://developers.soundcloud.com/assets/powered_by_white-371bd6967352fcc89673d4c81f7e5661.png" />
                </a>
                <a class="github-button" href="https://github.com/chrisdruta/nimbus" data-icon="octicon-star" data-show-count="true" aria-label="Star chrisdruta/nimbus on GitHub">Star</a>
                <a class="github-button" href="https://github.com/chrisdruta/nimbus/fork" data-icon="octicon-repo-forked" aria-label="Fork chrisdruta/nimbus on GitHub">Fork</a>
            </div>
            <span className="nimbus">nimbus</span>
            {divider}
            { store.userProfile === null ? <LoginArea /> : <LogoutArea /> }
            {divider}
            <span className="nav-label">YOUR LIBRARY</span>
            <span className="nav-category">Liked Tracks</span>
            <div style={{height: "25px"}}/>
            <span className="nav-label">PLAYLISTS</span>
            <span className="nav-playlist">hash</span>
        </div>
    );
}

export default SideNav;