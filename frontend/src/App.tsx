import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Home } from "@/pages/Home";
import { CreateDataset } from "@/pages/CreateDataset";
import { MergeDataset } from "@/pages/MergeDataset";
import { DatasetList } from "@/pages/DatasetList";
import { DatasetDetail } from "@/pages/DatasetDetail";
import { ImagePreview } from "@/pages/ImagePreview";
import { Search } from "@/pages/Search";
import { Settings } from "@/pages/Settings";
import { Logs } from "@/pages/Logs";
import { TrainModel } from "@/pages/TrainModel";
import { AugmentDataset } from "@/pages/AugmentDataset";
import { InferenceStudio } from "@/pages/InferenceStudio";
import { AnnotateSetup } from "@/pages/AnnotateSetup";
import { AnnotationWorkspace } from "@/pages/AnnotationWorkspace";

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateDataset />} />
        <Route path="/merge" element={<MergeDataset />} />
        <Route path="/train" element={<TrainModel />} />
        <Route path="/inference" element={<InferenceStudio />} />
        <Route path="/augment" element={<AugmentDataset />} />
        <Route path="/annotate" element={<AnnotateSetup />} />
        <Route path="/annotate/:name" element={<AnnotationWorkspace />} />
        <Route path="/datasets" element={<DatasetList />} />
        <Route path="/datasets/:name" element={<DatasetDetail />} />
        <Route path="/datasets/:name/images/:split/:filename" element={<ImagePreview />} />
        <Route path="/search" element={<Search />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/logs" element={<Logs />} />
      </Route>
    </Routes>
  );
}

export default App;
