import { useContext } from 'react';

import { Context } from '../../store';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRandom, faStepBackward, faStepForward, faRetweet } from '@fortawesome/free-solid-svg-icons'
import { faPlayCircle, faPauseCircle } from '@fortawesome/free-regular-svg-icons';

import './mediaBar.css';

function PlayerControls(props) {

    const { store, dispatch } = useContext(Context);

    return (
        <div className="playback-controls">
            <div className="playback-control-button-group">
                <FontAwesomeIcon icon={faRandom} className="playback-button" size="sm" onClick={() => dispatch({ type: "shuffle" })} />
                <FontAwesomeIcon icon={faStepBackward} className="playback-button" size="sm" onClick={() => dispatch({ type: "prev-track" })} />
                {store.playing ?
                    <FontAwesomeIcon icon={faPauseCircle} className="playback-button" size="2x" onClick={() => dispatch({ type: "play-pause" })}/>
                    :
                    <FontAwesomeIcon icon={faPlayCircle} className="playback-button" size="2x" onClick={() => dispatch({ type: "play-pause" })}/>
                }
                <FontAwesomeIcon icon={faStepForward} className="playback-button" size="sm" onClick={() => dispatch({ type: "next-track" })}/>
                <FontAwesomeIcon icon={faRetweet} className="playback-button" size="sm" onClick={() => dispatch({ type: "repeat-cycle" })}/>
            </div>
            <div className="playback-scrubber">
                <p>0:10</p>
                <div className="progress-bar">
                    <div className="progress-bar-filler" style={{ width: "10%" }} />
                </div>
                <p>1:00</p>
            </div>
        </div>
    );
}

export default PlayerControls;
