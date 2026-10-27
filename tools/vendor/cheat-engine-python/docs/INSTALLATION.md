# Installation Guide for Beginners

## Before You Start

This guide will help you install the MCP Cheat Engine Server step-by-step. Don't worry if you're not technical - we'll walk through everything together!

**Time needed**: About 15-20 minutes  
**Difficulty**: Beginner-friendly  
**What you'll learn**: How to set up a memory analysis tool safely

---

## Step 1: Check Your Computer

### What You Need
- **Windows 10 or Windows 11** (this tool works best on Windows)
- **At least 4GB of free space** on your hard drive
- **Administrator access** to your computer
- **Internet connection** to download files

### Check Your Windows Version
1. Click the **Start button**
2. Type **"About"** and click **"About your PC"**
3. Look for **"Windows 10"** or **"Windows 11"** in the results

✅ **Good to go?** Let's continue!  
❌ **Need help?** Ask someone tech-savvy to help you check these requirements.

---

## Step 2: Install Python

### What is Python?
Python is a programming language that our tool needs to run. Think of it like installing a special engine that powers our memory analysis tool.

### Download Python
1. Go to **[python.org](https://python.org)** in your web browser
2. Click the big yellow **"Download Python"** button
3. Your computer will download a file named something like **`python-3.12.x-amd64.exe`**

### Install Python
1. **Find the downloaded file** (usually in your Downloads folder)
2. **Right-click** on it and select **"Run as administrator"**
3. **IMPORTANT**: Check the box that says **"Add Python to PATH"**
4. Click **"Install Now"**
5. Wait for the installation to finish (this takes 2-3 minutes)
6. Click **"Close"** when done

### Test Python Installation
1. Press **Windows Key + R**
2. Type **`cmd`** and press **Enter**
3. In the black window that opens, type: **`python --version`**
4. Press **Enter**

You should see something like: **`Python 3.12.1`**

✅ **Seeing a version number?** Perfect!  
❌ **Getting an error?** Try restarting your computer and testing again.

---

## Step 3: Download the Server Files

### Get the Files
1. Download the server files to your computer
2. Extract/unzip them to a location like: **`C:\CheatEngineServer`**
3. Remember where you put them - you'll need this location!

### Verify the Files
Open the folder and make sure you see these items:
- 📁 **server** (folder)
- 📁 **docs** (folder) 
- 📄 **requirements.txt** (file)
- 📄 **README.md** (file)
- 📄 **manifest.json** (file)

---

## Step 4: Install Required Components

### Open PowerShell as Administrator
1. Click the **Start button**
2. Type **"PowerShell"**
3. **Right-click** on **"Windows PowerShell"**
4. Select **"Run as administrator"**
5. Click **"Yes"** when Windows asks for permission

### Navigate to Your Server Files
In the PowerShell window, type:
```powershell
cd C:\CheatEngineServer
```
(Replace `C:\CheatEngineServer` with wherever you extracted the files)

### Install Dependencies
Copy and paste this command exactly:
```powershell
pip install -r requirements.txt
```

**What happens now:**
- Your computer downloads needed software components
- This takes 2-5 minutes
- You'll see lots of text scrolling by - this is normal!
- Wait until you see something like "Successfully installed..."

### Common Issues and Solutions

**If you see "pip is not recognized":**
1. Close PowerShell
2. Restart your computer
3. Try the steps again

**If you see "Permission denied":**
1. Make sure you're running PowerShell as Administrator
2. Check that your antivirus isn't blocking the installation

**If downloads are slow:**
- This is normal! The first time takes longer
- Be patient and let it finish

---

## Step 5: Test Everything Works

### Run the Test
In PowerShell (still in your server directory), type:
```powershell
python server/main.py --test
```

### What Should Happen
You should see messages like:
```
MCP Cheat Engine Server initialized successfully
All components loaded correctly
Configuration files created
Server ready for use
```

✅ **Seeing success messages?** Congratulations! You're all set up!  
❌ **Getting errors?** Don't panic - see the troubleshooting section below.

---

## Step 6: Set Up Security (Important!)

### Create Process Whitelist
1. Go to your server folder
2. Open the **`server/config`** folder
3. Create a file called **`whitelist.json`**
4. Copy this content into the file:

```json
{
  "processes": [
    {
      "name": "notepad.exe",
      "allowed": true,
      "description": "Text editor for safe testing"
    },
    {
      "name": "calculator.exe",
      "allowed": true,
      "description": "Calculator for safe testing"
    }
  ]
}
```

### Why This Matters
This whitelist controls which programs the tool can analyze. Starting with safe programs like Notepad helps you learn without risks.

---

## Troubleshooting Common Issues

### "Python not found" Error
**Solution**: Python didn't install correctly
1. Uninstall Python from Control Panel
2. Reinstall Python, making sure to check "Add to PATH"
3. Restart your computer

### "Access denied" Errors
**Solution**: Permission problems
1. Always run PowerShell as Administrator
2. Check that your antivirus isn't blocking the files
3. Try disabling Windows Defender temporarily during installation

### "Module not found" Errors
**Solution**: Dependencies didn't install
1. Run: `pip install --upgrade pip`
2. Run: `pip install -r requirements.txt` again
3. Check your internet connection

### Files Won't Download
**Solution**: Network or antivirus issues
1. Temporarily disable antivirus
2. Check your internet connection
3. Try using a different network (mobile hotspot)

### General Installation Problems
**Solution**: Start fresh
1. Delete the server folder
2. Restart your computer
3. Follow this guide again from Step 1

---

## First Time Use

### Start Simple
Once everything is installed, try these safe first steps:

1. **Open Notepad** and type some text
2. **Open PowerShell as Administrator**
3. **Navigate to your server**: `cd C:\CheatEngineServer`
4. **Start the server**: `python server/main.py`
5. **In another application** (like Claude Desktop), try: "List all running processes"

### What to Expect
- You'll see a list of programs running on your computer
- Look for "notepad.exe" in the list
- This means everything is working correctly!

---

## Getting Help

### If You Get Stuck
1. **Read the error message carefully** - it often tells you what's wrong
2. **Check the troubleshooting section** above
3. **Try restarting your computer** - this fixes many issues
4. **Ask a tech-savvy friend** for help if needed

### Debug Information
If you need help, run this command and share the output:
```powershell
python server/main.py --debug --test
```

### Files to Check
When asking for help, these files contain useful information:
- **`logs/server.log`** - What the server is doing
- **`logs/errors.log`** - Any errors that occurred
- **`server/config/settings.json`** - Your configuration

---

## You're Ready!

🎉 **Congratulations!** You've successfully installed the MCP Cheat Engine Server.

### What's Next?
1. Read the **User Guide** to learn how to use the tool
2. Start with simple programs like Notepad
3. Learn gradually - don't try to do everything at once
4. Have fun exploring how computer memory works!

### Remember
- This tool is for learning and legitimate analysis only
- Always respect software licenses and terms of service
- Start with simple, safe programs
- The tool is read-only and can't harm your computer

### Need More Help?
- Check the **User Guide** for detailed usage instructions
- Look at the **FAQ** section for common questions
- Practice with safe programs before analyzing complex software

Welcome to the world of memory analysis! 🔍
