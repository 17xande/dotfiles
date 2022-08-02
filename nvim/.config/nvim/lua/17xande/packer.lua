local fn = vim.fn
local install_path = fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'
if fn.empty(fn.glob(install_path)) > 0 then
  packer_bootstrap = fn.system({'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path})
  vim.cmd [[packadd packer.nvim]]
end

--vim.o.shellslash = true

-- Only required if you have packer configured as `opt`
--vim.cmd [[packadd packer.nvim]]

local packStart = require('packer').startup(function(use)
  -- Packer can manage itself
  use('wbthomason/packer.nvim')

  use('neovim/nvim-lspconfig')

  -- neogit
  use({
    'TimUntersberger/neogit',
    requires = { {'nvim-lua/plenary.nvim'} }
  })

  -- Treesitter
  use({
    'nvim-treesitter/nvim-treesitter',
    run = ':TSUpdate'
  })

  require('nvim-treesitter.configs').setup {
    -- A list of parser names, or "all".
    ensure_installed = { "go", "lua", "rust" }
  }

  -- Telescope
  use({
    'nvim-telescope/telescope-fzf-native.nvim',
    run = 'cmake -S. -Bbuild -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release && cmake --install build --prefix build'
  })
  use({
    'nvim-telescope/telescope.nvim',
    requires = { {'nvim-lua/plenary.nvim'} }
  })

  use('ellisonleao/gruvbox.nvim')

  if packer_bootstrap then
    require('packer').sync()
  end
end)

-- configure Neovim to automatically run :PackerCompile whenever plugins.lua is updated
vim.cmd([[
  augroup packer_user_config
    autocmd!
    autocmd BufWritePost plugins.lua source <afile> | PackerCompile
  augroup end
]])

return packStart

