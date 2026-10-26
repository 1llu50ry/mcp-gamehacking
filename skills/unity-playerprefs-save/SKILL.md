---
name: unity-playerprefs-save
description: "Unity PlayerPrefs + Unity save files -- Windows registry, macOS plist, Linux ini, custom serialization via BinaryFormatter / Odin / JSON."
metadata:
  type: tool-reference
  source: curated
  topics: [unity, playerprefs, savegame, odin, binaryformatter]
---
# Unity Save Storage

Unity provides PlayerPrefs for small KV + lets devs roll their own save format.

## PlayerPrefs locations
- Windows: `HKCU\Software\<Company>\<Product>`.
- macOS: `~/Library/Preferences/unity.<Company>.<Product>.plist`.
- Linux: `~/.config/unity3d/<Company>/<Product>/prefs`.

## Custom save paths
- `Application.persistentDataPath` -- `%APPDATA%\..\LocalLow\<Company>\<Product>\`.
- BinaryFormatter -- .NET native serialization.
- Odin Inspector -- custom typed binary.
- JSON via JsonUtility or Newtonsoft.

## Edit workflow
- Pull PlayerPrefs via regedit or `plutil -convert xml1`.
- For BinaryFormatter dumps: `dnSpy` deserialize or dump via dotnet runtime hook.

## Related
[[ue-savegame-reverse]], the `unity-specialist` agent.
