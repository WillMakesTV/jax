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

