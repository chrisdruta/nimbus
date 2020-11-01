import { useContext, useEffect } from 'react';

import SoundCloudClient from '../soundcloudClient';

import { Context, initialState } from '../store';

import './loginAreas.css';

function LoginArea() {
    const { store, dispatch } = useContext(Context);

    const loadInitialData = async () => {
        const userProfile = await SoundCloudClient.resolveUserProfile(store.profileLink);
        console.log(userProfile);
        const userPlaylists = await SoundCloudClient.getUserPlaylists(userProfile.id);
        console.log(userPlaylists)

        SoundCloudClient.getAllLikes(userProfile.id)
            .then((likes) => {
                console.log(likes);
                dispatch({ type: "load-likes", data: likes });
            })
            .catch((e) => alert(e))

        dispatch({
            type: "set-user",
            data: {
                profile: userProfile,
                playlists: userPlaylists,
            }
        });
    };

    useEffect(() => {
        const rememberMe = window.localStorage.getItem("nimbus-rememberme");
        const profileLink = window.localStorage.getItem("nimbus-profilelink");
        if (rememberMe && profileLink) {
            dispatch({ type: "set-profilelink", data: profileLink });
            dispatch({ type: "set-rememberme", data: true });
        }
    }, []);



    return (
        <div className="logged-out-container">
            <span className="profile-link-input-label">enter profile url</span>
            <input type="text" className="profile-link-input" style={{ color: store.profileLink === initialState.profileLink ? "#ff4200" : "white" }}
                value={store.profileLink} onFocus={e => e.target.select()}
                onChange={(e) => dispatch({type: "set-profilelink", data: e.target.value})}
            />
            <img className="sc-connect" src="https://connect.soundcloud.com/2/btn-connect-sc-l.png" onClick={loadInitialData}/>
            <span style={{ alignSelf: "center" }}>
                <span className="profile-link-input-label">remember me</span>
                <input type="checkbox" title="remember me" checked={store.rememberMe} onChange={(e) => dispatch({ type: "set-rememberme", data: e.target.checked })}/>
            </span>
            
        </div>
    );
}

function LogoutArea() {
    const { store, dispatch } = useContext(Context);

    return (
        <div className="logged-in-container">
            <img className="sc-user-profile-pic" src={store.user.profile.avatar_url}/>
            <div className="sc-logout-stack">
                <span className="sc-username">{store.user.profile.username}</span>
                <img className="sc-disconnect" src="https://connect.soundcloud.com/2/btn-disconnect-m.png" onClick={() => dispatch({ type: "logout" })}/>
            </div>
        </div>
    );
}

export { LoginArea, LogoutArea };
