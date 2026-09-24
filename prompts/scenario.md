Draw how this scenario runs through the system, from the evidence below and the code it cites. Nothing is stored: the diagram is built on demand so it never goes stale (DEC-0011).

1. Start at the entry point and read the code of each tagged element in the order the call flows; follow imports and calls into other elements when the scenario crosses them. Elements listed here are tagged as participants; if the code shows another element taking part, include it and say so.
2. Draw a Mermaid `sequenceDiagram`: one participant per element (use the element names), external systems and datastores as participants too, messages labelled with what is sent or asked, not with function names. Keep it to the steps that matter for the business scenario, at most about fifteen messages.
3. Under the diagram, list in one line each the assumptions you made where the code was unclear, and any element that takes part but is not tagged with this scenario. Offer to tag it: `npx @openax/cli model set <id> --scenario <SCN-id>`.
4. Do not invent steps. If the entry point or a tagged element cannot be found in the code, say "I cannot determine" for that part.
