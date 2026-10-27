# Look-alike functions

Games are full of near-copies: copy-pasted code, the same inline helper expanded in many places,
template instantiations, one state handler per enemy type. `find_similar(function)` compares
instruction sequences (mnemonics in order) across the whole project and lists the closest functions,
matched ones first, with the matching source of the best one. The brief already mentions matched
look-alikes when there are any.

How to use it
- 90%+ similar and matched: start from that source; usually only names, offsets, constants or one
  branch differ.
- 70-90%: the same structure with a different body part; reuse the skeleton.
- Similar but unmatched: when you match one, the others get easier; note what you learned on them
  (`add_note`) so other agents benefit.

Beyond this project: games built on the same SDK or engine share code (libultra on N64, the Dolphin and
Revolution SDKs, NitroSDK on DS, PSY-Q on PS1, sead/nn on Switch, RenderWare, Havok...). Those library
functions are usually matched already in other public decomps.

Scheduling that works (from people who ran agents on decomps before): easiest functions first, then
functions similar to ones already matched. Cap the effort per function (around 25-30 compiles) and
release with notes rather than grinding.
