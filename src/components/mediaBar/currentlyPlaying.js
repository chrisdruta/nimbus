import './mediaBar.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeart as faHeartSolid, faShareAlt } from '@fortawesome/free-solid-svg-icons'
import { faHeart as faHeartOutline } from '@fortawesome/free-regular-svg-icons';

function CurrentlyPlaying(props) {
    return (
        <div className="currently-playing">
            <img className="small-album" src="https://i1.sndcdn.com/artworks-000221803133-etx99p-t50x50.jpg"/>
            <div style={{display: "flex", flexDirection: "column", justifyContent: "space-evenly", height: "60%", alignSelf: "center"}}>
                <span className="current-song-title">
                    Hong Kong 2046
                </span>
                <span className="current-song-author">
                    Hong Kong Express
                </span>
            </div>
            <FontAwesomeIcon icon={faHeartOutline} size="1x" className="playback-button" style={{paddingLeft: "20px"}}/>
            <FontAwesomeIcon icon={faShareAlt} size="sm" className="playback-button" style={{paddingLeft: "20px"}}/>
        </div>
    );
}

export default CurrentlyPlaying;
