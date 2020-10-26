import { useContext } from 'react';

import { Context } from '../../store';
import CurrentlyPlaying from './currentlyPlaying';
import PlayerControls from './playerControls';
import ExtraControls from './extraControls';

import './mediaBar.css';

function MediaBar(props) {

    const { store, dispatch } = useContext(Context);

    return (
        <div className="media-control-bar">
            <CurrentlyPlaying />
            <PlayerControls />
            <ExtraControls />
        </div>
    )
}

export default MediaBar;
