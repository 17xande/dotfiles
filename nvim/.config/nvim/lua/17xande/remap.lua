local M = {}

local function bind(op, outer_opts)
  outer_opts = outer_opts or {noremap = true}
  return function(lhs, rhs, opts)
    opts = vim.tbl_extend("force", outer_opts, opts or {})
    vim.keymap.set(op, lhs, rhs, opts)
  end
end

M.nmap = bind('n', {noremap = false})
M.nnoremap = bind('n')
M.vonremap = bind('v')
M.xnoremap = bind('x')
M.inoremap = bind('i')

return M

-- local nnoremap = M.nnoremap

-- nnoremap("<leader>pv", ":Ex")
-- -- nnoremap("<C-p>", ":Telescope")
-- nnoremap("<C-p>", ":lua require('telescope.builtin').git_files()<CR>")
-- nnoremap("<Leader>pf", ":lua require('telescope.builtin').find_files()<CR>")
-- nnoremap("<leader>ps", ":lua require('telescope.builtin').grep_string({ search = vim.fn.input(\"Grep For > \")})<CR>")
-- nnoremap("<leader>pw", ":lua require('telescope.builtin').grep_string { search = vim.fn.expand(\"<cword>\") }<CR>")
-- nnoremap("<leader>pb", ":lua require('telescope.builtin').buffers()<CR>")
-- nnoremap("<leader>vh", ":lua require('telescope.builtin').help_tags()<CR>")

