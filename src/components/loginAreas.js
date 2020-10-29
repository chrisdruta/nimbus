import { useContext } from 'react';

import SoundCloudClient from '../soundcloudClient';

import { Context, initialState } from '../store';

import './loginAreas.css';

function LoginArea() {
    const { store, dispatch } = useContext(Context);

    const loadData = async () => {
        const userProfile = await SoundCloudClient.resolveUserProfile("https://soundcloud.com/user-776216628");
        console.log(userProfile);
        dispatch({ type: "set-userprofile", data: userProfile });
    };

    return (
        <div className="logged-out-container">
            <span className="profile-link-input-label">enter profile url</span>
            <input type="text" className="profile-link-input"style={{ color: store.profileLink !== initialState.profileLink ? "#ff4200" : "white" }}
                value={store.profileLink} onFocus={e => e.target.select()}
                onChange={(e) => dispatch({type: "set-profilelink", data: e.target.value})}
            />
            <img className="sc-connect" src="https://connect.soundcloud.com/2/btn-connect-sc-l.png" onClick={loadData}/>
        </div>
    );
}

function LogoutArea() {
    const { store, dispatch } = useContext(Context);

    return (
        <div className="logged-in-container">
            <img className="sc-user-profile-pic" src={store.userProfile.avatar_url}/>
            <div className="sc-logout-stack">
                <span className="sc-username">{store.userProfile.username}</span>
                <img className="sc-disconnect" src="https://connect.soundcloud.com/2/btn-disconnect-l.png" onClick={() => dispatch({ type: "logout" })}/>
            </div>
        </div>
    );
}

export { LoginArea, LogoutArea };
