import {ownedHostShutdownProtocol,OWNED_HOST_STOP_TIMEOUT_MS,readOwnedHostShutdownAck,observeOwnedHostShutdown,installOwnedHostShutdown} from "./owned-host-shutdown.mjs";
// Compatibility wrapper: the exact original image wire protocol and bounds remain.
const protocol=ownedHostShutdownProtocol("image");
export const IMAGE_STOP_COMMAND=protocol.command;
export const IMAGE_STOP_PREFIX=protocol.prefix;
export const IMAGE_STOP_TIMEOUT_MS=OWNED_HOST_STOP_TIMEOUT_MS;
export const readImageShutdownAck=(...args)=>readOwnedHostShutdownAck("image",...args);
export const observeImageHostShutdown=(...args)=>observeOwnedHostShutdown("image",...args);
export const installImageHostShutdown=options=>installOwnedHostShutdown("image",options);
