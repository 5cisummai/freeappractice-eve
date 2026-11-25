import { eveChannel } from "eve/channels/eve";

// Keep the health route. All session operations use the private Coach channel.
export default eveChannel({ auth: [] });
