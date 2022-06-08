-- This file can be loaded by calling `lua require('plugins')` from your init.vim.
-- Or by calling `require('plugins')` from your init.lua. -- This is better, I think.

local fn = vim.fn
local install_path = fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'
if fn.empty(fn.glob(install_path)) > 0 then
  packer_bootstrap = fn.system({'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path})
end

local packer = require('packer')
local use = packer.use
return packer.startup(function()
  -- Packer can manage itself
  use 'wbthomason/packer.nvim'
  
  if packer_bootstrap then
    packer.sync()
  end
end)
