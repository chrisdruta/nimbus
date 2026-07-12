import { createContext } from 'react';

export const initialState = {
    playing: false,
    profileLink: "https://soundcloud.com/your-user-profile",
    rememberMe: false,
    loading: false,
    user: {
        profile: null,
        likes: null,
        playlists: null
    },
    browsePlaylist: "userLikes",
    headerColor: "transparent",
};

export const reducer = (state, action) => {
    switch (action.type) {
        /* Profile styff */
        case "set-profilelink":
            return { ...state, profileLink: action.data };
        case "set-rememberme":
            return { ...state, rememberMe: action.data };
        case "set-user":
            window.localStorage.setItem("nimbus-rememberme", state.rememberMe);
            if (state.rememberMe) {
                window.localStorage.setItem("nimbus-profilelink", state.profileLink);
            } else {
                window.localStorage.removeItem("nimbus-profilelink");
            }
            return {
                ...state,
                user: action.data,
                loading: true,
            };
        case "load-likes":
            return {
                ...state,
                user: { ...state.user, likes: action.data },
                loading: false
            }
        
        case "logout":
            return {
                ...state,
                user: initialState.user,
                browsePlaylist: initialState.browsePlaylist,
            };

        /* Queue stuff */
        case "set-browseplaylist":
            return { ...state, browsePlaylist: action.data };
        case "set-headercolor":
            return { ...state, headerColor: action.data };

        /* Player stuff */
        case "play-pause":
            if (state.playing)
                return { ...state, playing: false };
            else
                return { ...state, playing: true };

        default:
            console.log("not implemented")
            return state;
    }
};

export const Context = createContext();
