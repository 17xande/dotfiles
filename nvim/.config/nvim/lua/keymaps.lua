local M = {}

function M.nnoremap(lhs, rhs)
  vim.keymap.set("n", lhs, rhs, {noremap = true})
end

local nnoremap = M.nnoremap

nnoremap("<leader>pv", ":Ex")
-- nnoremap("<C-p>", ":Telescope")
nnoremap("<C-p>", ":lua require('telescope.builtin').git_files()<CR>")
nnoremap("<Leader>pf", ":lua require('telescope.builtin').find_files()<CR>")
nnoremap("<leader>ps", ":lua require('telescope.builtin').grep_string({ search = vim.fn.input(\"Grep For > \")})<CR>")
nnoremap("<leader>pw", ":lua require('telescope.builtin').grep_string { search = vim.fn.expand(\"<cword>\") }<CR>")
nnoremap("<leader>pb", ":lua require('telescope.builtin').buffers()<CR>")
nnoremap("<leader>vh", ":lua require('telescope.builtin').help_tags()<CR>")

