import { useReducer, useEffect } from 'react';

import SideNav from './components/nav';
import MediaBar from './components/mediaBar/mediaBar';
import { initialState, reducer, Context} from './store';

import * as SC from 'soundcloud';

import './App.css';

import SoundCloudClient from './soundcloudClient';

function App() {
  const [store, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    

    //SC.initialize(opts);

    //SC.connect({client_id: 'Er1X3lNvhwhxFYGHxmF0oMtSoKXz3G2D', redirect_uri: 'soundcloud-callback.html'}).then(data=>console.log(data))
    //SC.connect().then(data=>console.log(data))

    //SC.stream("/tracks/293").then(player => console.log(player.play()))
    //SC.resolve('https://soundcloud.com/user-776216628').then((data) => console.log(data));

    // SC.get('users/293625125/favorites?linked_partitioning=true&limit=10000&offset=1').then((data) => {
    //   console.log("first", data)
    //   // const next = data.next_href.substring(data.next_href.indexOf("/users"), data.next_href.length)
    //   // SC.get(next).then((data2) => console.log("second", data2))
    // });

    // SC.stream('/tracks/206106098').then((player) => {
    //   player.play().then(() => console.log("starting playback")).catch((err) => console.log("Error starting playback", err))
    // });

    // loadData();

  }, []);

  return (
    <Context.Provider value={{ store, dispatch }}>
      <div className="App">
        <div style={{display: "flex", height: "100%"}}>
          <SideNav />
          <span style={{color: "white", padding: "100px"}}>
            {store.playing.toString()}
          </span>
        </div>
        <MediaBar dispatch={dispatch}/>
      </div>
    </Context.Provider>
  );
}

export default App;
