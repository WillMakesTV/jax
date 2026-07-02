export namespace main {
	
	export class AuthPollResult {
	    status: string;
	    account: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthPollResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.account = source["account"];
	        this.message = source["message"];
	    }
	}
	export class ChannelSource {
	    title: string;
	    url: string;
	    account: string;
	
	    static createFrom(source: any = {}) {
	        return new ChannelSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.url = source["url"];
	        this.account = source["account"];
	    }
	}
	export class ChatMessage {
	    id: string;
	    platform: string;
	    author: string;
	    text: string;
	    publishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.platform = source["platform"];
	        this.author = source["author"];
	        this.text = source["text"];
	        this.publishedAt = source["publishedAt"];
	    }
	}
	export class DetailItem {
	    label: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new DetailItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.value = source["value"];
	    }
	}
	export class DeviceCodeInfo {
	    deviceCode: string;
	    userCode: string;
	    verificationUri: string;
	    interval: number;
	    expiresIn: number;
	
	    static createFrom(source: any = {}) {
	        return new DeviceCodeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.deviceCode = source["deviceCode"];
	        this.userCode = source["userCode"];
	        this.verificationUri = source["verificationUri"];
	        this.interval = source["interval"];
	        this.expiresIn = source["expiresIn"];
	    }
	}
	export class LiveChatPage {
	    live: boolean;
	    messages: ChatMessage[];
	    nextPageToken: string;
	    pollIntervalMs: number;
	
	    static createFrom(source: any = {}) {
	        return new LiveChatPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.live = source["live"];
	        this.messages = this.convertValues(source["messages"], ChatMessage);
	        this.nextPageToken = source["nextPageToken"];
	        this.pollIntervalMs = source["pollIntervalMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LiveStream {
	    platform: string;
	    live: boolean;
	    error: string;
	    channelName: string;
	    channelLogin: string;
	    channelUrl: string;
	    streamUrl: string;
	    title: string;
	    category: string;
	    viewerCount: number;
	    startedAt: string;
	    thumbnailUrl: string;
	    details: DetailItem[];
	
	    static createFrom(source: any = {}) {
	        return new LiveStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.live = source["live"];
	        this.error = source["error"];
	        this.channelName = source["channelName"];
	        this.channelLogin = source["channelLogin"];
	        this.channelUrl = source["channelUrl"];
	        this.streamUrl = source["streamUrl"];
	        this.title = source["title"];
	        this.category = source["category"];
	        this.viewerCount = source["viewerCount"];
	        this.startedAt = source["startedAt"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.details = this.convertValues(source["details"], DetailItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PastBroadcast {
	    platform: string;
	    title: string;
	    url: string;
	    thumbnailUrl: string;
	    startedAt: string;
	    duration: string;
	    durationSecs: number;
	    viewCount: number;
	
	    static createFrom(source: any = {}) {
	        return new PastBroadcast(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.title = source["title"];
	        this.url = source["url"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.startedAt = source["startedAt"];
	        this.duration = source["duration"];
	        this.durationSecs = source["durationSecs"];
	        this.viewCount = source["viewCount"];
	    }
	}
	export class PastStream {
	    title: string;
	    thumbnailUrl: string;
	    startedAt: string;
	    totalViews: number;
	    groupId: string;
	    broadcasts: PastBroadcast[];
	
	    static createFrom(source: any = {}) {
	        return new PastStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.startedAt = source["startedAt"];
	        this.totalViews = source["totalViews"];
	        this.groupId = source["groupId"];
	        this.broadcasts = this.convertValues(source["broadcasts"], PastBroadcast);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Profile {
	    name: string;
	    email: string;
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.email = source["email"];
	    }
	}
	export class ServiceConfig {
	    twitchClientId: string;
	    youtubeClientId: string;
	    youtubeClientSecret: string;
	    obsHost: string;
	    obsPort: string;
	    obsPassword: string;
	    obsAutoConnect: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ServiceConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.twitchClientId = source["twitchClientId"];
	        this.youtubeClientId = source["youtubeClientId"];
	        this.youtubeClientSecret = source["youtubeClientSecret"];
	        this.obsHost = source["obsHost"];
	        this.obsPort = source["obsPort"];
	        this.obsPassword = source["obsPassword"];
	        this.obsAutoConnect = source["obsAutoConnect"];
	    }
	}
	export class ServiceStatus {
	    name: string;
	    connected: boolean;
	    account: string;
	
	    static createFrom(source: any = {}) {
	        return new ServiceStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.connected = source["connected"];
	        this.account = source["account"];
	    }
	}
	export class Stream {
	    title: string;
	    description: string;
	    channelSource: ChannelSource;
	    plan: string;
	
	    static createFrom(source: any = {}) {
	        return new Stream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.description = source["description"];
	        this.channelSource = this.convertValues(source["channelSource"], ChannelSource);
	        this.plan = source["plan"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

