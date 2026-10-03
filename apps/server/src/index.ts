import { createApp } from './app.js';
import { loadConfig } from './config.js';
const config=loadConfig();
const {app}=await createApp(config);
for(const signal of ['SIGTERM','SIGINT'] as const) process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
await app.listen({port:config.port,host:config.host});
