import CurrentlyPlaying from './currentlyPlaying';
import PlayerControls from './playerControls';
import ExtraControls from './extraControls';

function MediaBar(props) {

    return (
        <div className="media-control-bar">
            <CurrentlyPlaying />
            <PlayerControls playing={false} />
            <ExtraControls />
        </div>
    )
}

export default MediaBar;
