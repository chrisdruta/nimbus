import axios from 'axios';

class SoundCloudClient {
    V1_URL = "https://api.soundcloud.com";
    V2_URL = "https://api-v2.soundcloud.com";

    // taken from online github projects, open up api registration again sc ffs its been 4 years
    CLIENT_ID = "a3dd183a357fcff9a6943c0d65664087";

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
}

export default new SoundCloudClient();