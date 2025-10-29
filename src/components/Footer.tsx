export const Footer = () => {
  return (
    <footer className="border-t border-gray-600 py-12 text-white">
      <div className="w-[96%] max-w-screen-lg mx-auto flex flex-row justify-between">
        <div className="flex items-center">
          <span className="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">
            <span className="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">
              Plinkoo.100x
            </span>
          </span>
        </div>
        <div>
          <div className="space-y-2">
            <h1 className="text-center text-lg">Follow On</h1>
            <div className="flex items-center gap-3">
              <a href="https://github.com/hkirat" target="_blank">
                Git Hub
              </a>
              <a href="https://www.youtube.com/@harkirat1" target="_blank">
                YouTube
              </a>
              <a href="https://twitter.com/kirat_tw" target="_blank">
                Twitter{" "}
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
