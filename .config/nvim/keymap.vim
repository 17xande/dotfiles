" Key remaps

let mapleader = " "

" mode lhs rhs
" n: normal mode; nore: no recursive execution; map: remap;
nnoremap <leader>ps :lua require('telescope.builtin').grep_string({ search = vim.fn.input("Grep for > ")})<CR> 
nnoremap <leader>tt :echo "this is a test"<CR>

