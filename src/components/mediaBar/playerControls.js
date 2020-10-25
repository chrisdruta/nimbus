import './mediaBar.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRandom, faStepBackward, faStepForward, faRetweet } from '@fortawesome/free-solid-svg-icons'
import { faPlayCircle, faPauseCircle } from '@fortawesome/free-regular-svg-icons';

function playerReducer(state, action) {
    switch(action.type) {
        case 'play-pause':
            return {  };
    }
}

function PlayerControls(props) {

    return (
        <div className="playback-controls">
                <div className="playback-control-button-group">
                    <FontAwesomeIcon icon={faRandom} className="playback-button" size="sm" onClick={(e) => alert("hi")}/>
                    <FontAwesomeIcon icon={faStepBackward} className="playback-button" size="sm"/>
                    { props.playing ?
                        <FontAwesomeIcon icon={faPauseCircle} className="playback-button" size="lg"/>
                        :
                        <FontAwesomeIcon icon={faPlayCircle} className="playback-button" size="2x"/>
                    }
                    <FontAwesomeIcon icon={faStepForward} className="playback-button" size="sm"/>
                    <FontAwesomeIcon icon={faRetweet} className="playback-button" size="sm"/>
                </div>
                <div className="playback-scrubber">
                    <p>0:10</p>
                    <div className="progress-bar">
                        <div className="progress-bar-filler" style={{width: "10%"}}/>
                    </div>
                    <p>1:00</p>
                </div>
            </div>
    );
}

export default PlayerControls;
