/** Owned acquisition is registered immediately; every failure cleanup runs. */
export async function openManagedReferenceListener(dependencies) {
  let database, host, listener;
  async function settle() {
    const failures=[];
    for(const cleanup of [
      async()=>host?.shutdownBackgroundTasks(),
      async()=>{if(listener?.listening)await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));},
      async()=>host?.closePersistence(),
      async()=>database?.close(),
    ]) {try {await cleanup();}catch(error){failures.push(error);}}
    if(failures.length)throw new Error("Managed listener cleanup failed.");
  }
  try {
    database=await dependencies.openDatabase();
    const prepared=dependencies.prepareEnvironment();
    host=await dependencies.createHost(database,prepared);
    listener=dependencies.createListener(host);
    await new Promise((resolve,reject)=>{listener.once("error",reject);listener.listen(host.config.port,"127.0.0.1",resolve);});
    let closing;
    return {close(){return closing??=settle();}};
  }catch(error){try{await settle();}catch{}throw error;}
}

export function assertIsolatedPostgresInspection(inspection, fixture, image) {
  if(inspection?.Config?.Labels?.["ai-system-builder.qualification"]!=="true" ||
     inspection.Config.Labels["ai-system-builder.run"]!==fixture.id || inspection.Config.Image!==image)throw new Error("Database fixture ownership differs.");
  const ports=inspection.NetworkSettings?.Ports;
  if(!ports || Object.keys(ports).length!==1 || !Array.isArray(ports["5432/tcp"]) || ports["5432/tcp"].length!==1 ||
     ports["5432/tcp"][0].HostIp!=="127.0.0.1" || Number(ports["5432/tcp"][0].HostPort)!==fixture.port)throw new Error("Database fixture must have exactly one expected loopback binding.");
}

export function assertOwnedWorkerObservation(scenario, count) {
  if (!["immediate", "observed-download", "worker-failure-download", "disconnect-download"].includes(scenario) ||
      !Number.isInteger(count) || count < 0 || count > 64 || (scenario !== "immediate" && count === 0)) {
    throw new Error("Owned task qualification requires actual bounded worker observation.");
  }
}
