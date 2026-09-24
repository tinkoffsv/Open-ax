Decide whether the change below is *architecturally significant*.

An architecturally significant change alters the structure of the system: which components exist, how they communicate, where state lives, or which mechanisms solve cross-cutting problems. Examples:

- a new database, datastore, or persistence mechanism
- a new cache
- a new queue, message broker, or background-job mechanism
- a new external service or third-party API integration
- a new authentication or authorization mechanism
- a new major framework or library that shapes how code is written
- a new deployment or runtime component (service, container, worker, cron, serverless function)
- a new communication mechanism between components (webhooks, polling, events, RPC, websockets)
- a second mechanism for something the project already appears to solve (e.g. a polling job next to existing webhooks, a new HTTP client next to an existing one)

NOT significant (ignore these):

- renames, formatting, comments, copy/text changes
- CSS/UI/layout changes
- simple bug fixes, small validation changes
- tests
- straightforward refactoring that does not change system structure
- adding a function, endpoint, or field that uses mechanisms already present in the project
- version bumps of existing dependencies

Be conservative. Interrupting a developer is expensive. Mark a change significant only when there is concrete evidence in the diff. When in doubt, it is NOT significant.

Describe only what the diff shows. Do not guess the developer's motivation.

If it is significant, write for yourself:
- a one-sentence summary of the architectural impact
- short items such as "new infrastructure dependency: Redis" or "new background processing mechanism: Celery"
