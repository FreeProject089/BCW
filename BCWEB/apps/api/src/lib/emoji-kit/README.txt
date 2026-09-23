BetterCommunity bot icons - the offline kit
===========================================

The easiest way is the "Upload to Discord" button on the site (Discord bot > Icons on
Discord): it does all of this for you with the token the site already has. Use this kit
only when that is not possible.

What is in the folder
  icons/            one PNG per icon, named bc_<key>_<version>.png (the name Discord gets)
  sync-icons.bat    Windows: double-click it
  sync-icons.sh     macOS / Linux: run  sh sync-icons.sh  (needs python3)

Steps
  1. Unzip the whole folder somewhere (the scripts look for "icons" next to themselves).
  2. Run the script for your system.
  3. Paste the bot token when it asks (Discord Developer Portal > your application > Bot).
     It is typed hidden, sent to discord.com only, and never saved. You can also set it in
     the DISCORD_TOKEN environment variable beforehand.
  4. It lists each icon as present / older drawing only / missing, asks before uploading,
     then uploads what is missing. Icons already on Discord are skipped, so running it
     twice is harmless.
  5. It writes app-emojis.json next to itself. On the site: Discord bot > Icons on Discord
     > Import the map, choose that file. The site then shows every icon as on Discord.

What the scripts do NOT do
  They are the same file for everybody: nothing in them comes from the site's data, they
  contain no token or password, and they download nothing. They talk to discord.com only.
  Read them before running them if you like: they are short and commented.
