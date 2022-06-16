-- This file can be loaded by calling `lua require('plugins')` from your init.vim.
-- Or by calling `require('plugins')` from your init.lua. -- This is better, I think.

local fn = vim.fn
local install_path = fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'
if fn.empty(fn.glob(install_path)) > 0 then
  packer_bootstrap = fn.system({'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path})
end

require('nvim-treesitter.configs').setup {
  -- A list of parser names, or "all".
 ensure_installed = { "go", "lua", "rust" }
}

local packer = require('packer')
local use = packer.use
return packer.startup(function()
  -- Packer can manage itself
  use 'wbthomason/packer.nvim'

  -- Treesitter
  use {
    'nvim-treesitter/nvim-treesitter',
    run = ':TSUpdate'
  }

  -- Plenary
  use 'nvim-lua/plenary.nvim'

  -- Telescope
  use {
    'nvim-telescope/telescope-fzf-native.nvim',
    run = 'cmake -S. -Bbuild -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release && cmake --install build --prefix build'
  }
  use {
    'nvim-telescope/telescope.nvim',
    requires = { {'nvim-lua/plenary.nvim'} }
  }

  use 'gruvbox-community/gruvbox'

  if packer_bootstrap then
    packer.sync()
  end
end)



