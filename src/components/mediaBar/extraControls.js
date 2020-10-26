import './mediaBar.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpandAlt, faList, faVolumeUp, faWaveSquare } from '@fortawesome/free-solid-svg-icons'
import { faHeart as faHeartOutline } from '@fortawesome/free-regular-svg-icons';

function ExtraControls(props) {
    return (
        <div className="extra-controls">
            <FontAwesomeIcon className="playback-button" icon={faList}/>
            <FontAwesomeIcon className="playback-button" icon={faVolumeUp}/>
            <div className="volume-bar">
                <div className="volume-bar-filler" style={{width: "75%"}}/>
            </div>
            <FontAwesomeIcon className="playback-button" icon={faWaveSquare}/>
            <FontAwesomeIcon className="playback-button" icon={faExpandAlt}/>
        </div>
    );
}

export default ExtraControls;