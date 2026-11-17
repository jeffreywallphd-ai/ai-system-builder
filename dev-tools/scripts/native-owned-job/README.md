# Owned Windows worker lifetime fixture

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This fixture tests one newly created, harmless Python worker. It uses an unnamed
Windows job, assigns the worker during process creation, and checks membership
and the fixed limits before the worker runs. It accepts no caller command or path.
The worker has a 256 MiB native commit limit and a 20-second self-exit deadline.

Run the model-free tests with the repository's Python 3.12 runtime:

```text
python -B -m unittest discover -s dev-tools/scripts/native-owned-job/tests -p test_owned_job_fixture.py
```

The tests keep an exact worker process handle across normal supervisor closure,
input loss and supervisor termination. A temporary job query handle must close
before each trigger. A timeout or uncertain close fails the test.
This declared fixture accepts only observed job-close exit code zero. The worker's
20-second fallback returns code 75 and cannot qualify. A native negative control
waits for that fallback and proves both observers reject it. Unexpected nonzero
exits also fail. An extra-job-handle control proves why all temporary job query
handles must close before the positive crash test.

This is separate implementation support. It does not start a model, inspect old
temporary files, create an offload lease or change the production runtime. Worker
exit does not prove that file protection survives until exit after a supervisor
crash. Protected file accounting, journal durability and that ordering remain
pending agent work. Completed model accuracy checks stay closed.

The mechanism follows Microsoft's [job-list process attribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
and [job-object lifecycle](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
documentation. Those APIs do not supply a filesystem protection guarantee.
