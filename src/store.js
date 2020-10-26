import { createContext } from 'react';

export const initialState = {
    playing: true
};

export const reducer = (state, action) => {
    switch (action.type) {
        case "play-pause":
            if (state.playing)
                return { playing: false };
            else
                return { playing: true };
        default:
            console.log("not implemented")
            return state;
    }
};

export const Context = createContext();
