import axios from 'axios';

class SoundCloudClient {
    V1_URL = "https://api.soundcloud.com";
    V2_URL = "https://api-v2.soundcloud.com";
    CORS_ANYWHERE = "https://cors-anywhere.herokuapp.com/";

    // taken from online github projects, open up api registration again sc ffs its been 4 years
    CLIENT_ID = "a3dd183a357fcff9a6943c0d65664087";
    //CLIENT_ID = "fDoItMDbsbZz8dY16ZzARCZmzgHBPotA";

    appendClientId(url) {
        if (url.indexOf("?") > -1) {
            return `${url}&client_id=${this.CLIENT_ID}`;
        }
        return `${url}?client_id=${this.CLIENT_ID}`;
    }

    async resolveUserProfile(url) {
        url = this.appendClientId(`${this.V1_URL}/resolve?url=${url}`);
        console.log("getting profile at", url)
        return (await axios.get(url)).data;
    }

    async getUserPlaylists(userId) {
        const url = this.appendClientId(`${this.V1_URL}/users/${userId}/playlists`);
        console.log("getting user playlists at", url)
        return (await axios.get(url)).data;
    }

    async getAllLikes(userId) {
        let url = this.appendClientId(`${this.V1_URL}/users/${userId}/favorites?linked_partitioning=true&page_size=100`);
        console.log("getting all likes at", url)

        let res = (await axios.get(url));
        console.log(res)
        res = res.data;
        let likedSongs = res.collection;

        while (res.next_href) {
            res = (await axios.get(this.appendClientId(res.next_href))).data;
            likedSongs = likedSongs.concat(res.collection);
        }

        console.log(likedSongs)

        return likedSongs;
    }
}

export default new SoundCloudClient();