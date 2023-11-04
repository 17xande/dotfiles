vim.opt.nu = true
vim.opt.relativenumber = true

vim.opt.tabstop = 8
vim.opt.expandtab = false
vim.opt.softtabstop = 2
vim.opt.shiftwidth = 2

vim.opt.smartindent = true
vim.opt.wrap = false

vim.opt.swapfile = false
vim.opt.backup = false
vim.opt.undodir = os.getenv("HOME") .. "/.vim/undodir"

vim.opt.incsearch = true

vim.opt.scrolloff = 8
vim.opt.isfname:append("@-@")

if vim.fn.has("wsl") == 1 then
   vim.g.clipboard = {
      name = 'WslClipboard',
      copy = {
         ["+"] = { 'clip.exe' },
         ["*"] = { 'clip.exe' },
      },
      paste = {
         ["+"] = { 'powershell.exe -c [Console]::Out.Write($(Get-Clipboard -Raw).tostring().replace("`r", ""))' },
         ["*"] = { 'powershell.exe -c [Console]::Out.Write($(Get-Clipboard -Raw).tostring().replace("`r", ""))' },
      },
      cache_enabled = 0,
   }
end
