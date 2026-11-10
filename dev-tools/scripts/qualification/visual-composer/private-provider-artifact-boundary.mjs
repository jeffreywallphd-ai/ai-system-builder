/** Recording-free private tests. Keep the installed fixture's option semantics. */
export async function runPrivateProviderArtifactBoundary(playwright,combinedOptions,use,testInfo){
  testInfo.setTimeout(testInfo.project.timeout);
  const forward=async options=>{
    for(const [key,value]of Object.entries(combinedOptions))if(!(key in options))options[key]=value;
  };
  const listener={runBeforeCreateBrowserContext:forward,runBeforeCreateRequestContext:forward};
  const instrumentation=playwright._instrumentation;
  let primary,primaryFailed=false,cleanup,cleanupFailed=false;
  try{instrumentation.addListener(listener);await use();}
  catch(error){primary=error;primaryFailed=true;}
  // Remove this exact listener even when registration partly failed. The
  // installed instrumentation removes absent listeners without side effects.
  try{instrumentation.removeListener(listener);}
  catch(error){cleanup=error;cleanupFailed=true;}
  if(primaryFailed&&cleanupFailed)throw new AggregateError([primary,cleanup],"Private test setup and listener cleanup failed.");
  if(primaryFailed)throw primary;
  if(cleanupFailed)throw cleanup;
}
