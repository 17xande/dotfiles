local set = vim.opt

set.tabstop = 2
set.shiftwidth = 2
set.softtabstop = 2
set.expandtab = true
set.smartindent = true

set.nu = true
set.relativenumber = true
set.hidden = true
set.swapfile = false 
set.backup = false
set.undodir = vim.fn.stdpath('config') .. '/undo'
set.undofile = true
set.incsearch = true
set.scrolloff = 6
set.signcolumn = 'yes'
set.wrap = false

vim.g.mapleader = " "

require('plugins')
require('keymaps')

vim.cmd [[
  colorscheme gruvbox
  highlight Normal guibg=none
]]

vim.cmd([[
  augroup packer_user_config
    autocmd!
    autocmd BufWritePost plugins.lua source <afile> | PackerCompile
  augroup end
]])

