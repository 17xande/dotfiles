local M = {}

function M.nnoremap(lhs, rhs)
  vim.keymap.set("n", lhs, rhs, {noremap = true})
end

local nnoremap = M.nnoremap

nnoremap("<leader>pv", ":Ex")
nnoremap("<C-p>", ":Telescope")

