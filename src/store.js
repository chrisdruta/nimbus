import { createContext } from 'react';

export const initialState = {
    playing: false,
    profileLink: "https://soundcloud.com/your-user-profile",
    //profileLink: "https://soundcloud.com/user-776216628",
    userProfile: null
};

export const reducer = (state, action) => {
    switch (action.type) {
        case "play-pause":
            if (state.playing)
                return { ...state, playing: false };
            else
                return { ...state, playing: true };
        case "set-profilelink":
            return { ...state, profileLink: action.data };
        case "set-userprofile":
            return { ...state, userProfile: action.data };
        case "logout":
            return { ...state, userProfile: null, profileLink: initialState.profileLink };
        default:
            console.log("not implemented")
            return state;
    }
};

export const Context = createContext();
