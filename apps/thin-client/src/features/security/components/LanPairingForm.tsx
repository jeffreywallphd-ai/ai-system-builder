import { useState } from "react";

import { TermWithHint } from "../../../../../../modules/ui/shared";

export function LanPairingForm(props: { onSubmit: (pairingCode: string, deviceName?: string) => Promise<boolean>; busy?: boolean }) {
  const [pairingCode, setPairingCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  return <form className="ui-stack ui-stack--sm" onSubmit={(event) => { event.preventDefault(); void props.onSubmit(pairingCode, deviceName || undefined); }}>
    <label className="ui-stack ui-stack--xs"><span><TermWithHint termId="pairingCode">Pairing code</TermWithHint></span><input className="ui-input" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} /></label>
    <label className="ui-stack ui-stack--xs"><span><TermWithHint termId="deviceName">Device name</TermWithHint> (optional)</span><input className="ui-input" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
    <button className="ui-button" type="submit" disabled={props.busy || pairingCode.trim().length < 1}>{props.busy ? "Pairing..." : "Pair this device"}</button>
  </form>;
}
