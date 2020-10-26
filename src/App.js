import { useReducer, useState } from 'react';

import SideNav from './components/nav';
import MediaBar from './components/mediaBar/mediaBar';
import { initialState, reducer, Context} from './store';

import './App.css';

function App() {

  const [store, dispatch] = useReducer(reducer, initialState);

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
